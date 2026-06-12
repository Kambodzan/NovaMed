"""clinic photo url

Revision ID: 6ed36802fb61
Revises: d3cfb3b25cde
Create Date: 2026-06-12 05:29:27.055216

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '6ed36802fb61'
down_revision: Union[str, None] = 'd3cfb3b25cde'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clinic", sa.Column("photo_url", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("clinic", "photo_url")
