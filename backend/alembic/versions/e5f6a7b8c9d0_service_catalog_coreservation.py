"""katalog usług (service, doctor_service) + współrezerwacja na appointment

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-19 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'service',
        sa.Column('service_id', sa.Uuid(), nullable=False),
        sa.Column('clinic_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('specialization', sa.String(length=100), nullable=True),
        sa.Column('duration_min', sa.Integer(), nullable=False, server_default='15'),
        sa.Column('price', sa.Numeric(precision=8, scale=2), nullable=True),
        sa.Column('referral_required', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinic.clinic_id']),
        sa.PrimaryKeyConstraint('service_id'),
    )
    op.create_table(
        'doctor_service',
        sa.Column('doctor_service_id', sa.Uuid(), nullable=False),
        sa.Column('doctor_id', sa.Uuid(), nullable=False),
        sa.Column('service_id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctor.doctor_id']),
        sa.ForeignKeyConstraint(['service_id'], ['service.service_id']),
        sa.PrimaryKeyConstraint('doctor_service_id'),
        sa.UniqueConstraint('doctor_id', 'service_id', name='uq_doctor_service'),
    )
    op.add_column('appointment', sa.Column('service_id', sa.Uuid(), nullable=True))
    op.add_column('appointment', sa.Column('duration_min', sa.Integer(), nullable=True))
    op.add_column('appointment', sa.Column('blocked_by_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_appointment_service', 'appointment', 'service', ['service_id'], ['service_id'])
    op.create_foreign_key('fk_appointment_blocked_by', 'appointment', 'appointment', ['blocked_by_id'], ['appointment_id'])


def downgrade() -> None:
    op.drop_constraint('fk_appointment_blocked_by', 'appointment', type_='foreignkey')
    op.drop_constraint('fk_appointment_service', 'appointment', type_='foreignkey')
    op.drop_column('appointment', 'blocked_by_id')
    op.drop_column('appointment', 'duration_min')
    op.drop_column('appointment', 'service_id')
    op.drop_table('doctor_service')
    op.drop_table('service')
