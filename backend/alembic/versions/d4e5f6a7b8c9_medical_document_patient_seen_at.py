"""medical_document: patient_seen_at (obejrzane przez pacjenta)

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-19 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('medical_document', sa.Column('patient_seen_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('medical_document', 'patient_seen_at')
