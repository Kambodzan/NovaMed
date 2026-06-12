"""badania diagnostyczne

Revision ID: a899d3eee533
Revises: 6ed36802fb61
Create Date: 2026-06-12 05:45:25.973337

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a899d3eee533'
down_revision: Union[str, None] = '6ed36802fb61'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("appointment", "doctor_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("appointment", sa.Column("service_name", sa.String(length=100), nullable=True))
    op.add_column("appointment", sa.Column("referral_required", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("appointment", sa.Column("referral_document_id", sa.Integer(), nullable=True))
    op.add_column("appointment", sa.Column("external_referral", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.create_foreign_key("fk_appointment_referral_doc", "appointment", "medical_document",
                          ["referral_document_id"], ["document_id"])


def downgrade() -> None:
    op.drop_constraint("fk_appointment_referral_doc", "appointment", type_="foreignkey")
    op.drop_column("appointment", "external_referral")
    op.drop_column("appointment", "referral_document_id")
    op.drop_column("appointment", "referral_required")
    op.drop_column("appointment", "service_name")
    op.alter_column("appointment", "doctor_id", existing_type=sa.Integer(), nullable=False)
