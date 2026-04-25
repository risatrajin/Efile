"""MongoDB connection singleton."""
import os
from motor.motor_asyncio import AsyncIOMotorClient

_client: AsyncIOMotorClient | None = None
_db = None


def get_db():
    global _client, _db
    if _client is None:
        _client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        _db = _client[os.environ["DB_NAME"]]
    return _db


async def create_indexes():
    db = get_db()
    await db.users.create_index("email", unique=True)
    await db.users.create_index("role")
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.login_attempts.create_index("identifier")
    await db.engagements.create_index("assigned_cpa_id")
    await db.engagements.create_index("ws_advisor_id")
    await db.engagements.create_index("status")
    await db.documents.create_index("engagement_id")
    await db.opportunities.create_index("engagement_id")
    await db.time_entries.create_index("engagement_id")
    await db.checklist.create_index("engagement_id")
    await db.notifications.create_index([("user_id", 1), ("is_read", 1)])
    await db.status_history.create_index("engagement_id")
    await db.messages.create_index([("engagement_id", 1), ("created_at", 1)])
    await db.messages.create_index([("engagement_id", 1), ("is_read", 1), ("sender_id", 1)])
