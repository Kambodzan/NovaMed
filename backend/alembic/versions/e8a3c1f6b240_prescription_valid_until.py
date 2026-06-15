"""prescription valid_until (ważność e-recepty)

Revision ID: e8a3c1f6b240
Revises: d7e2f4a8c1b9
Create Date: 2026-06-15 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e8a3c1f6b240'
down_revision: Union[str, None] = 'd7e2f4a8c1b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("prescription", sa.Column("valid_until", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("prescription", "valid_until")
