"""clinic city

Revision ID: 66f94d8bb676
Revises: c397a15e509d
Create Date: 2026-06-12 04:47:39.310319

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '66f94d8bb676'
down_revision: Union[str, None] = 'c397a15e509d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clinic", sa.Column("city", sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column("clinic", "city")
