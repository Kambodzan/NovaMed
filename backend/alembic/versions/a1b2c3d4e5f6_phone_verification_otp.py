"""phone_verification: OTP telefonu dla rezerwacji publicznej i rejestracji

Revision ID: a1b2c3d4e5f6
Revises: 37e6c795b09c
Create Date: 2026-06-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '37e6c795b09c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'phone_verification',
        sa.Column('verification_id', sa.Uuid(), nullable=False),
        sa.Column('phone', sa.String(length=20), nullable=False),
        sa.Column('purpose', sa.String(length=20), nullable=False),
        sa.Column('code_hash', sa.String(length=64), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('verified_at', sa.DateTime(), nullable=True),
        sa.Column('consumed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('verification_id'),
    )
    op.create_index('ix_phone_verification_lookup', 'phone_verification', ['phone', 'purpose'])


def downgrade() -> None:
    op.drop_index('ix_phone_verification_lookup', table_name='phone_verification')
    op.drop_table('phone_verification')
