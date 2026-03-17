"""SQLite persistence layer for VoxelChain.

Persists world state, player inventories, economy data, and marketplace
across server restarts.
"""

import json
import logging
import os
import sqlite3
import time
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class PersistenceLayer:
    """SQLite-based persistence for VoxelChain game data."""

    def __init__(self, db_path: str = "/tmp/voxelchain-data/voxelchain.db"):
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self.db_path)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
        return self._conn

    def _init_db(self):
        """Create tables if they don't exist."""
        conn = self._get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS chunks (
                cx INTEGER NOT NULL,
                cy INTEGER NOT NULL,
                cz INTEGER NOT NULL,
                blocks BLOB NOT NULL,
                merkle_root TEXT DEFAULT '',
                owner TEXT DEFAULT '',
                last_modified REAL DEFAULT 0,
                tx_hash TEXT DEFAULT '',
                PRIMARY KEY (cx, cy, cz)
            );

            CREATE TABLE IF NOT EXISTS players (
                address TEXT PRIMARY KEY,
                display_name TEXT DEFAULT '',
                items TEXT DEFAULT '{}',
                vxl_balance REAL DEFAULT 0.0,
                total_mined INTEGER DEFAULT 0,
                total_placed INTEGER DEFAULT 0,
                last_active REAL DEFAULT 0,
                created_at REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS market_listings (
                listing_id TEXT PRIMARY KEY,
                seller TEXT NOT NULL,
                item_type INTEGER NOT NULL,
                item_count INTEGER NOT NULL,
                price_vxl REAL NOT NULL,
                created_at REAL NOT NULL,
                expires_at REAL DEFAULT 0,
                listing_type TEXT DEFAULT 'item',
                land_x INTEGER DEFAULT 0,
                land_z INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS block_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                x INTEGER NOT NULL,
                y INTEGER NOT NULL,
                z INTEGER NOT NULL,
                old_type INTEGER DEFAULT 0,
                new_type INTEGER DEFAULT 0,
                player TEXT DEFAULT '',
                timestamp REAL NOT NULL,
                merkle_root TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS economy_stats (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_changes_timestamp ON block_changes(timestamp);
            CREATE INDEX IF NOT EXISTS idx_changes_player ON block_changes(player);
            CREATE INDEX IF NOT EXISTS idx_listings_seller ON market_listings(seller);
            CREATE INDEX IF NOT EXISTS idx_players_balance ON players(vxl_balance);
        """)
        conn.commit()
        logger.info("Database initialized: %s", self.db_path)

    # === Chunk Persistence ===

    def save_chunk(self, cx: int, cy: int, cz: int, blocks: bytes,
                   merkle_root: str = "", owner: str = "",
                   tx_hash: str = ""):
        """Save chunk data to database."""
        conn = self._get_conn()
        conn.execute("""
            INSERT OR REPLACE INTO chunks (cx, cy, cz, blocks, merkle_root, owner, last_modified, tx_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (cx, cy, cz, blocks, merkle_root, owner, time.time(), tx_hash))
        conn.commit()

    def load_chunk(self, cx: int, cy: int, cz: int) -> Optional[Tuple[bytes, str, str]]:
        """Load chunk from database. Returns (blocks, merkle_root, owner) or None."""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT blocks, merkle_root, owner FROM chunks WHERE cx=? AND cy=? AND cz=?",
            (cx, cy, cz)
        ).fetchone()
        if row:
            return (row["blocks"], row["merkle_root"], row["owner"])
        return None

    def get_loaded_chunk_count(self) -> int:
        """Get number of chunks stored in database."""
        conn = self._get_conn()
        row = conn.execute("SELECT COUNT(*) as cnt FROM chunks").fetchone()
        return row["cnt"] if row else 0

    # === Player Persistence ===

    def save_player(self, address: str, display_name: str, items: Dict[int, int],
                    vxl_balance: float, total_mined: int, total_placed: int):
        """Save player data."""
        conn = self._get_conn()
        now = time.time()
        conn.execute("""
            INSERT INTO players (address, display_name, items, vxl_balance, total_mined, total_placed, last_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(address) DO UPDATE SET
                display_name=excluded.display_name,
                items=excluded.items,
                vxl_balance=excluded.vxl_balance,
                total_mined=excluded.total_mined,
                total_placed=excluded.total_placed,
                last_active=excluded.last_active
        """, (address, display_name, json.dumps(items), vxl_balance,
              total_mined, total_placed, now, now))
        conn.commit()

    def load_player(self, address: str) -> Optional[dict]:
        """Load player data. Returns dict or None."""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM players WHERE address=?", (address,)
        ).fetchone()
        if row:
            items_raw = row["items"]
            items = {}
            try:
                parsed = json.loads(items_raw)
                items = {int(k): v for k, v in parsed.items()}
            except (json.JSONDecodeError, ValueError):
                pass
            return {
                "address": row["address"],
                "display_name": row["display_name"],
                "items": items,
                "vxl_balance": row["vxl_balance"],
                "total_mined": row["total_mined"],
                "total_placed": row["total_placed"],
                "last_active": row["last_active"],
            }
        return None

    def load_all_players(self) -> List[dict]:
        """Load all player data."""
        conn = self._get_conn()
        rows = conn.execute("SELECT * FROM players ORDER BY vxl_balance DESC").fetchall()
        players = []
        for row in rows:
            items = {}
            try:
                parsed = json.loads(row["items"])
                items = {int(k): v for k, v in parsed.items()}
            except (json.JSONDecodeError, ValueError):
                pass
            players.append({
                "address": row["address"],
                "display_name": row["display_name"],
                "items": items,
                "vxl_balance": row["vxl_balance"],
                "total_mined": row["total_mined"],
                "total_placed": row["total_placed"],
                "last_active": row["last_active"],
            })
        return players

    # === Market Persistence ===

    def save_listing(self, listing_id: str, seller: str, item_type: int,
                     item_count: int, price_vxl: float, created_at: float,
                     expires_at: float, listing_type: str,
                     land_x: int = 0, land_z: int = 0):
        """Save a marketplace listing."""
        conn = self._get_conn()
        conn.execute("""
            INSERT OR REPLACE INTO market_listings
            (listing_id, seller, item_type, item_count, price_vxl, created_at, expires_at, listing_type, land_x, land_z)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (listing_id, seller, item_type, item_count, price_vxl,
              created_at, expires_at, listing_type, land_x, land_z))
        conn.commit()

    def delete_listing(self, listing_id: str):
        """Delete a marketplace listing."""
        conn = self._get_conn()
        conn.execute("DELETE FROM market_listings WHERE listing_id=?", (listing_id,))
        conn.commit()

    def load_all_listings(self) -> List[dict]:
        """Load all active marketplace listings."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM market_listings ORDER BY created_at DESC"
        ).fetchall()
        return [dict(row) for row in rows]

    # === Block Change Log ===

    def log_block_change(self, x: int, y: int, z: int, old_type: int,
                         new_type: int, player: str, merkle_root: str = ""):
        """Log a block change for audit trail."""
        conn = self._get_conn()
        conn.execute("""
            INSERT INTO block_changes (x, y, z, old_type, new_type, player, timestamp, merkle_root)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (x, y, z, old_type, new_type, player, time.time(), merkle_root))
        conn.commit()

    def get_recent_changes(self, limit: int = 50) -> List[dict]:
        """Get recent block changes."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM block_changes ORDER BY timestamp DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(row) for row in rows]

    # === Economy Stats ===

    def save_economy_stat(self, key: str, value: str):
        """Save an economy statistic."""
        conn = self._get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO economy_stats (key, value) VALUES (?, ?)",
            (key, value)
        )
        conn.commit()

    def load_economy_stat(self, key: str, default: str = "0") -> str:
        """Load an economy statistic."""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT value FROM economy_stats WHERE key=?", (key,)
        ).fetchone()
        return row["value"] if row else default

    # === Batch operations ===

    def save_all_players(self, players: Dict[str, "PlayerInventory"]):
        """Batch save all player data."""
        conn = self._get_conn()
        now = time.time()
        for addr, player in players.items():
            conn.execute("""
                INSERT INTO players (address, display_name, items, vxl_balance, total_mined, total_placed, last_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(address) DO UPDATE SET
                    items=excluded.items,
                    vxl_balance=excluded.vxl_balance,
                    total_mined=excluded.total_mined,
                    total_placed=excluded.total_placed,
                    last_active=excluded.last_active
            """, (addr, "", json.dumps({str(k): v for k, v in player.items.items()}),
                  player.vxl_balance, player.total_mined, player.total_placed, now, now))
        conn.commit()

    def close(self):
        """Close database connection."""
        if self._conn:
            self._conn.close()
            self._conn = None
