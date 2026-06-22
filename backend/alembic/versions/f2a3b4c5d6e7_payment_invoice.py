"""payment.invoice_requested + invoice_number — faktura (mini-mock)

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-06-22

"""
from alembic import op
import sqlalchemy as sa

revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payment", sa.Column(
        "invoice_requested", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("payment", sa.Column("invoice_number", sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column("payment", "invoice_number")
    op.drop_column("payment", "invoice_requested")
