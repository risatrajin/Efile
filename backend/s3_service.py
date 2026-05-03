"""AWS S3 presigned URL generation for direct client uploads/downloads."""
import os
import logging
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, EndpointConnectionError

log = logging.getLogger(__name__)

_client = None

# Last error from the most recent failed S3 mutation. Read by ``server.py``
# after a failed ``put_object_bytes`` so it can decide whether to raise an
# admin-visible alert (e.g. on ``AccessDenied``).
_last_error_code: str | None = None
_last_error_message: str | None = None


def last_error_info() -> tuple[str | None, str | None]:
    """Return ``(code, message)`` from the most recent failed S3 call."""
    return _last_error_code, _last_error_message


def _record_failure(err: Exception, action: str) -> None:
    """Stash the last error and emit a structured log line.

    For ``AccessDenied`` we emit a LOUD ``[S3 ACCESS DENIED]`` log marker so
    operators can grep for it in production. Other codes drop through as a
    regular ERROR-level log.
    """
    global _last_error_code, _last_error_message
    code: str | None = None
    msg = str(err)
    if isinstance(err, ClientError):
        code = (err.response or {}).get("Error", {}).get("Code")
    elif isinstance(err, EndpointConnectionError):
        code = "EndpointConnectionError"
    _last_error_code = code
    _last_error_message = msg
    if code == "AccessDenied":
        log.error(
            "[S3 ACCESS DENIED] action=%s bucket=%s — IAM is missing the required action. "
            "Apply docs/aws-iam-policy.json. Detail: %s",
            action, bucket_name(), msg,
        )
    else:
        log.error("S3 %s failed (code=%s): %s", action, code, msg)


def get_client():
    global _client
    if _client is None:
        region = os.environ["AWS_REGION"]
        # ``ca-west-1`` (and other post-2019 regions) only accept Signature
        # Version 4 requests scoped to the regional endpoint. Using the
        # default endpoint produces an ``IllegalLocationConstraintException``
        # on PUT. Force both the regional endpoint and virtual-host addressing
        # style so presigned URLs inherit the correct signature target.
        _client = boto3.client(
            "s3",
            region_name=region,
            endpoint_url=f"https://s3.{region}.amazonaws.com",
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
        )
    return _client


def bucket_name() -> str:
    return os.environ["S3_BUCKET_NAME"]


def expiration() -> int:
    return int(os.environ.get("PRESIGNED_URL_EXPIRATION", 900))


def generate_upload_url(object_key: str, content_type: str = "application/octet-stream") -> dict | None:
    try:
        url = get_client().generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": bucket_name(),
                "Key": object_key,
                "ContentType": content_type,
                "ServerSideEncryption": "AES256",
            },
            ExpiresIn=expiration(),
            HttpMethod="PUT",
        )
        return {"upload_url": url, "object_key": object_key, "expires_in": expiration()}
    except (ClientError, EndpointConnectionError) as e:
        _record_failure(e, "presigned PUT")
        return None


def generate_download_url(object_key: str, filename: str | None = None) -> str | None:
    try:
        params = {"Bucket": bucket_name(), "Key": object_key}
        if filename:
            params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
        url = get_client().generate_presigned_url(
            ClientMethod="get_object",
            Params=params,
            ExpiresIn=expiration(),
            HttpMethod="GET",
        )
        return url
    except (ClientError, EndpointConnectionError) as e:
        _record_failure(e, "presigned GET")
        return None


def object_exists(object_key: str) -> bool:
    try:
        get_client().head_object(Bucket=bucket_name(), Key=object_key)
        return True
    except ClientError:
        return False
    except EndpointConnectionError:
        return False


def get_object_bytes(object_key: str) -> bytes | None:
    # Local-disk fallback storage: the rest of the app stamps ``object_key``
    # with a ``local://<absolute_path>`` prefix when S3 upload was blocked by
    # CORS/IAM and we proxied to disk. Read straight from the filesystem so
    # that AI Extract and any other byte-consumers work uniformly across
    # both storage paths.
    if object_key and object_key.startswith("local://"):
        path = object_key[len("local://"):]
        try:
            with open(path, "rb") as fh:
                return fh.read()
        except OSError as e:
            log.error("Local get_object_bytes failed for %s: %s", path, e)
            return None
    try:
        resp = get_client().get_object(Bucket=bucket_name(), Key=object_key)
        return resp["Body"].read()
    except (ClientError, EndpointConnectionError) as e:
        _record_failure(e, "get_object")
        return None


def put_object_bytes(object_key: str, body: bytes, content_type: str = "application/octet-stream") -> bool:
    """Server-side direct upload (used as proxy when browser-direct PUT is blocked by CORS).

    On failure, ``last_error_info()`` returns the AWS error code + message so
    callers can react to specific conditions (most importantly raising an
    admin alert when IAM is mis-configured and we get ``AccessDenied``).
    """
    global _last_error_code, _last_error_message
    try:
        get_client().put_object(
            Bucket=bucket_name(),
            Key=object_key,
            Body=body,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
        # Reset the last-error sentinel on a successful call so stale alerts
        # don't fire after the IAM mis-configuration is fixed.
        _last_error_code = None
        _last_error_message = None
        return True
    except (ClientError, EndpointConnectionError) as e:
        _record_failure(e, "put_object")
        return False


def delete_prefix(prefix: str) -> dict:
    """Delete every object under ``prefix``. Returns a summary dict.

    Used by the admin DB-reset flow to clear demo artifacts before launch.
    Non-fatal: individual S3 failures (e.g. current IAM policy missing
    ``s3:DeleteObject``) are logged and reported without aborting.
    """
    deleted = 0
    errors = 0
    try:
        cli = get_client()
        paginator = cli.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket_name(), Prefix=prefix):
            keys = [{"Key": obj["Key"]} for obj in (page.get("Contents") or [])]
            if not keys:
                continue
            try:
                resp = cli.delete_objects(Bucket=bucket_name(), Delete={"Objects": keys, "Quiet": True})
                deleted += len(keys) - len(resp.get("Errors") or [])
                errors += len(resp.get("Errors") or [])
            except (ClientError, EndpointConnectionError) as e:
                log.warning("S3 delete_objects batch failed: %s", e)
                errors += len(keys)
    except (ClientError, EndpointConnectionError) as e:
        log.warning("S3 delete_prefix failed for %s: %s", prefix, e)
        return {"deleted": 0, "errors": 0, "error": str(e)}
    return {"deleted": deleted, "errors": errors}
