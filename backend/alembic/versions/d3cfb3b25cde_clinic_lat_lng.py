"""clinic lat lng

Revision ID: d3cfb3b25cde
Revises: 66f94d8bb676
Create Date: 2026-06-12 04:53:11.016694

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd3cfb3b25cde'
down_revision: Union[str, None] = '66f94d8bb676'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clinic", sa.Column("lat", sa.Float(), nullable=True))
    op.add_column("clinic", sa.Column("lng", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("clinic", "lng")
    op.drop_column("clinic", "lat")
