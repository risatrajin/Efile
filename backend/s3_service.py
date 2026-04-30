"""AWS S3 presigned URL generation for direct client uploads/downloads."""
import os
import logging
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, EndpointConnectionError

log = logging.getLogger(__name__)

_client = None


def get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            region_name=os.environ["AWS_REGION"],
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4"),
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
        log.error("S3 presigned PUT failed: %s", e)
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
        log.error("S3 presigned GET failed: %s", e)
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
    try:
        resp = get_client().get_object(Bucket=bucket_name(), Key=object_key)
        return resp["Body"].read()
    except (ClientError, EndpointConnectionError) as e:
        log.error("S3 get_object failed: %s", e)
        return None



def put_object_bytes(object_key: str, body: bytes, content_type: str = "application/octet-stream") -> bool:
    """Server-side direct upload (used as proxy when browser-direct PUT is blocked by CORS)."""
    try:
        get_client().put_object(
            Bucket=bucket_name(),
            Key=object_key,
            Body=body,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
        return True
    except (ClientError, EndpointConnectionError) as e:
        log.error("S3 put_object failed: %s", e)
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
