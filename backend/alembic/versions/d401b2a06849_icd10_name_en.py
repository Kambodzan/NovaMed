"""icd10 name_en

Revision ID: d401b2a06849
Revises: 934810a5ab0a
Create Date: 2026-06-15 01:30:41.904296

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd401b2a06849'
down_revision: Union[str, None] = '934810a5ab0a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("icd10_dict", sa.Column("name_en", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("icd10_dict", "name_en")
