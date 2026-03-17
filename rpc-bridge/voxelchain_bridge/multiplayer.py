"""Multiplayer event system for VoxelChain.

Manages player sessions, presence, and event broadcasting.
"""

import logging
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Set

logger = logging.getLogger(__name__)


@dataclass
class PlayerSession:
    """Active player session."""
    address: str
    display_name: str
    position: Dict[str, float]  # x, y, z
    look_direction: Dict[str, float]  # pitch, yaw
    joined_at: float
    last_heartbeat: float
    chunk_subscriptions: Set[str]  # set of "cx,cy,cz" keys

    def is_alive(self, timeout: float = 30.0) -> bool:
        return time.time() - self.last_heartbeat < timeout

    def to_dict(self) -> dict:
        return {
            "address": self.address,
            "displayName": self.display_name,
            "position": self.position,
            "lookDirection": self.look_direction,
            "joinedAt": self.joined_at,
        }


@dataclass
class GameEvent:
    """A game event to broadcast to connected clients."""
    event_type: str
    data: dict
    timestamp: float
    source_player: str = ""
    target_chunk: str = ""  # "cx,cy,cz" if chunk-specific


class MultiplayerManager:
    """Manages multiplayer sessions and event broadcasting."""

    def __init__(self, max_players: int = 100):
        self.max_players = max_players
        self.sessions: Dict[str, PlayerSession] = {}
        self.event_log: List[GameEvent] = []
        self._max_event_log = 1000

    def player_join(self, address: str, display_name: str = "",
                    position: Optional[Dict[str, float]] = None) -> dict:
        """Register a player joining the world."""
        if len(self.sessions) >= self.max_players:
            return {"error": "Server full", "maxPlayers": self.max_players}

        if not display_name:
            display_name = address[:8] + "..."

        now = time.time()
        session = PlayerSession(
            address=address,
            display_name=display_name,
            position=position or {"x": 8.0, "y": 30.0, "z": 8.0},
            look_direction={"pitch": 0.0, "yaw": 0.0},
            joined_at=now,
            last_heartbeat=now,
            chunk_subscriptions=set(),
        )
        self.sessions[address] = session

        self._add_event(GameEvent(
            event_type="player_join",
            data={"player": session.to_dict()},
            timestamp=now,
            source_player=address,
        ))

        logger.info("Player joined: %s (%s)", display_name, address)
        return {
            "success": True,
            "session": session.to_dict(),
            "onlinePlayers": len(self.sessions),
        }

    def player_leave(self, address: str) -> dict:
        """Remove a player from the world."""
        session = self.sessions.pop(address, None)
        if not session:
            return {"success": False}

        self._add_event(GameEvent(
            event_type="player_leave",
            data={"address": address, "displayName": session.display_name},
            timestamp=time.time(),
            source_player=address,
        ))

        logger.info("Player left: %s", session.display_name)
        return {"success": True, "onlinePlayers": len(self.sessions)}

    def update_position(self, address: str, position: Dict[str, float],
                        look_direction: Optional[Dict[str, float]] = None) -> bool:
        """Update a player's position."""
        session = self.sessions.get(address)
        if not session:
            return False

        session.position = position
        if look_direction:
            session.look_direction = look_direction
        session.last_heartbeat = time.time()
        return True

    def heartbeat(self, address: str) -> bool:
        """Keep a player's session alive."""
        session = self.sessions.get(address)
        if not session:
            return False
        session.last_heartbeat = time.time()
        return True

    def subscribe_chunk(self, address: str, cx: int, cy: int, cz: int):
        """Subscribe a player to chunk update events."""
        session = self.sessions.get(address)
        if session:
            session.chunk_subscriptions.add(f"{cx},{cy},{cz}")

    def unsubscribe_chunk(self, address: str, cx: int, cy: int, cz: int):
        """Unsubscribe a player from chunk updates."""
        session = self.sessions.get(address)
        if session:
            session.chunk_subscriptions.discard(f"{cx},{cy},{cz}")

    def get_online_players(self) -> List[dict]:
        """Get list of online players."""
        self._cleanup_stale_sessions()
        return [s.to_dict() for s in self.sessions.values()]

    def get_player_count(self) -> int:
        """Get count of online players."""
        return len(self.sessions)

    def get_nearby_players(self, position: Dict[str, float],
                           radius: float = 64.0) -> List[dict]:
        """Get players within radius of a position."""
        px, py, pz = position.get("x", 0), position.get("y", 0), position.get("z", 0)
        nearby = []
        for session in self.sessions.values():
            sp = session.position
            dx = sp["x"] - px
            dy = sp["y"] - py
            dz = sp["z"] - pz
            dist = (dx * dx + dy * dy + dz * dz) ** 0.5
            if dist <= radius:
                d = session.to_dict()
                d["distance"] = round(dist, 2)
                nearby.append(d)
        return nearby

    def broadcast_chat(self, sender: str, message: str) -> dict:
        """Broadcast a chat message."""
        session = self.sessions.get(sender)
        display_name = session.display_name if session else sender[:8] + "..."

        event = GameEvent(
            event_type="chat",
            data={
                "sender": sender,
                "displayName": display_name,
                "message": message[:256],  # Max 256 chars
            },
            timestamp=time.time(),
            source_player=sender,
        )
        self._add_event(event)

        return {
            "type": "chat",
            "sender": sender,
            "displayName": display_name,
            "message": message[:256],
            "timestamp": event.timestamp,
        }

    def get_recent_events(self, since_timestamp: float = 0,
                          limit: int = 50) -> List[dict]:
        """Get recent game events since a timestamp."""
        events = []
        for event in reversed(self.event_log):
            if event.timestamp <= since_timestamp:
                break
            events.append({
                "type": event.event_type,
                "data": event.data,
                "timestamp": event.timestamp,
                "source": event.source_player,
            })
            if len(events) >= limit:
                break
        events.reverse()
        return events

    def get_server_info(self) -> dict:
        """Get server multiplayer info."""
        return {
            "onlinePlayers": len(self.sessions),
            "maxPlayers": self.max_players,
            "recentEvents": len(self.event_log),
        }

    def _add_event(self, event: GameEvent):
        """Add event to log."""
        self.event_log.append(event)
        if len(self.event_log) > self._max_event_log:
            self.event_log = self.event_log[-self._max_event_log:]

    def _cleanup_stale_sessions(self):
        """Remove sessions that haven't sent heartbeat."""
        stale = [
            addr for addr, session in self.sessions.items()
            if not session.is_alive()
        ]
        for addr in stale:
            self.player_leave(addr)
