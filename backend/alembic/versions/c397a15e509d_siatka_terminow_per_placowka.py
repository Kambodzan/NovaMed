"""siatka terminow per placowka

Revision ID: c397a15e509d
Revises: 151470653fdf
Create Date: 2026-06-12 01:49:17.758261

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c397a15e509d'
down_revision: Union[str, None] = '151470653fdf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clinic", sa.Column("slot_interval_min", sa.Integer(), nullable=False, server_default=sa.text("15")))


def downgrade() -> None:
    op.drop_column("clinic", "slot_interval_min")
