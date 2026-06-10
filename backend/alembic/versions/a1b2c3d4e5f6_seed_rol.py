"""seed słownika ról

Revision ID: a1b2c3d4e5f6
Revises: 8036bf49a3e3
Create Date: 2026-06-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "8036bf49a3e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ROLES = [
    ("pacjent", "Pacjent — Portal Pacjenta i aplikacja mobilna"),
    ("lekarz", "Lekarz — Portal Lekarza"),
    ("pielegniarka", "Pielęgniarka — Portal Pielęgniarki"),
    ("rejestracja", "Pracownik rejestracji — Panel Poradni"),
    ("kierownik", "Kierownik placówki — Panel Poradni"),
    ("administrator", "Administrator systemowy — Panel Administratora"),
]


def upgrade() -> None:
    role = sa.table(
        "role",
        sa.column("role_name", sa.String),
        sa.column("role_description", sa.String),
    )
    op.bulk_insert(role, [{"role_name": n, "role_description": d} for n, d in ROLES])


def downgrade() -> None:
    names = ", ".join(f"'{n}'" for n, _ in ROLES)
    op.execute(f"DELETE FROM role WHERE role_name IN ({names})")
