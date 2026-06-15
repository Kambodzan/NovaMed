"""patient dane kliniczne (alergie, choroby przewlekłe, leki stałe)

Revision ID: c4f1a9b2d3e7
Revises: 7bb1770223eb
Create Date: 2026-06-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4f1a9b2d3e7'
down_revision: Union[str, None] = '7bb1770223eb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("patient", sa.Column("allergies", sa.Text(), nullable=True))
    op.add_column("patient", sa.Column("chronic_diseases", sa.Text(), nullable=True))
    op.add_column("patient", sa.Column("chronic_medications", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("patient", "chronic_medications")
    op.drop_column("patient", "chronic_diseases")
    op.drop_column("patient", "allergies")
