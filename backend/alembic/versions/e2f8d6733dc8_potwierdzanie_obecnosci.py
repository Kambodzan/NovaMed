"""potwierdzanie obecnosci

Revision ID: e2f8d6733dc8
Revises: 9bdaca7ebf11
Create Date: 2026-06-12 07:30:19.620728

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e2f8d6733dc8'
down_revision: Union[str, None] = '9bdaca7ebf11'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clinic", sa.Column("confirmation_required", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("clinic", sa.Column("confirmation_hours", sa.Integer(), nullable=False, server_default=sa.text("48")))
    op.add_column("appointment", sa.Column("confirmation_requested", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("appointment", sa.Column("patient_confirmed", sa.Boolean(), nullable=False, server_default=sa.text("false")))


def downgrade() -> None:
    op.drop_column("appointment", "patient_confirmed")
    op.drop_column("appointment", "confirmation_requested")
    op.drop_column("clinic", "confirmation_hours")
    op.drop_column("clinic", "confirmation_required")
