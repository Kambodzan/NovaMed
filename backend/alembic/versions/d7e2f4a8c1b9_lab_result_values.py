"""lab_result wartości ustrukturyzowane (values_json)

Revision ID: d7e2f4a8c1b9
Revises: c4f1a9b2d3e7
Create Date: 2026-06-15 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7e2f4a8c1b9'
down_revision: Union[str, None] = 'c4f1a9b2d3e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("lab_result", sa.Column("values_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("lab_result", "values_json")
