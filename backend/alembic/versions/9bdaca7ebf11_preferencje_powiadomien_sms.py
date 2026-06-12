"""preferencje powiadomien sms

Revision ID: 9bdaca7ebf11
Revises: a899d3eee533
Create Date: 2026-06-12 06:34:00.227486

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9bdaca7ebf11'
down_revision: Union[str, None] = 'a899d3eee533'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("app_user", sa.Column("notify_sms", sa.Boolean(), nullable=False, server_default=sa.text("true")))


def downgrade() -> None:
    op.drop_column("app_user", "notify_sms")
