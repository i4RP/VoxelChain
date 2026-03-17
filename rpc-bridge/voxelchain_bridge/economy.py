"""Economy system for VoxelChain.

Manages mining rewards, player balances, and marketplace.
"""

import logging
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class MiningReward:
    """Reward definition for mining/breaking blocks."""
    block_type: int
    base_reward: float      # VXL reward for breaking
    item_drop: int          # Item type ID dropped
    item_count: int         # Number of items dropped
    rarity: float           # 0.0-1.0, higher = more rare = more reward
    tool_required: int      # Minimum tool tier (0 = hand)


# Mining reward definitions
MINING_REWARDS: Dict[int, MiningReward] = {
    1: MiningReward(block_type=1, base_reward=0.001, item_drop=14, item_count=1, rarity=0.0, tool_required=0),    # stone -> cobblestone
    2: MiningReward(block_type=2, base_reward=0.0005, item_drop=2, item_count=1, rarity=0.0, tool_required=0),    # dirt
    3: MiningReward(block_type=3, base_reward=0.001, item_drop=2, item_count=1, rarity=0.0, tool_required=0),     # grass -> dirt
    4: MiningReward(block_type=4, base_reward=0.0005, item_drop=4, item_count=1, rarity=0.0, tool_required=0),    # sand
    6: MiningReward(block_type=6, base_reward=0.002, item_drop=6, item_count=1, rarity=0.1, tool_required=0),     # wood
    7: MiningReward(block_type=7, base_reward=0.0001, item_drop=0, item_count=0, rarity=0.0, tool_required=0),    # leaves -> nothing
    8: MiningReward(block_type=8, base_reward=0.003, item_drop=8, item_count=1, rarity=0.2, tool_required=1),     # brick
    10: MiningReward(block_type=10, base_reward=0.05, item_drop=10, item_count=1, rarity=0.5, tool_required=1),   # iron ore
    11: MiningReward(block_type=11, base_reward=0.15, item_drop=11, item_count=1, rarity=0.7, tool_required=2),   # gold ore
    12: MiningReward(block_type=12, base_reward=0.5, item_drop=12, item_count=1, rarity=0.9, tool_required=2),    # diamond ore
    14: MiningReward(block_type=14, base_reward=0.001, item_drop=14, item_count=1, rarity=0.0, tool_required=0),  # cobblestone
    19: MiningReward(block_type=19, base_reward=0.1, item_drop=19, item_count=1, rarity=0.6, tool_required=3),    # obsidian
    20: MiningReward(block_type=20, base_reward=0.002, item_drop=20, item_count=1, rarity=0.1, tool_required=0),  # clay
}


@dataclass
class MarketListing:
    """A marketplace listing for an item or land."""
    listing_id: str
    seller: str         # Ethereum address
    item_type: int
    item_count: int
    price_vxl: float    # Price in VXL
    created_at: float
    expires_at: float   # 0 = no expiration
    listing_type: str   # "item" or "land"
    land_x: int = 0     # For land listings
    land_z: int = 0


class PlayerInventory:
    """Manages a player's inventory of items and balances."""

    def __init__(self, address: str):
        self.address = address
        self.items: Dict[int, int] = {}   # item_type -> count
        self.vxl_balance: float = 0.0
        self.total_mined: int = 0
        self.total_placed: int = 0
        self.last_active: float = time.time()

    def add_item(self, item_type: int, count: int = 1):
        """Add items to inventory."""
        self.items[item_type] = self.items.get(item_type, 0) + count

    def remove_item(self, item_type: int, count: int = 1) -> bool:
        """Remove items from inventory. Returns False if insufficient."""
        current = self.items.get(item_type, 0)
        if current < count:
            return False
        self.items[item_type] = current - count
        if self.items[item_type] <= 0:
            del self.items[item_type]
        return True

    def has_item(self, item_type: int, count: int = 1) -> bool:
        """Check if player has enough of an item."""
        return self.items.get(item_type, 0) >= count

    def to_dict(self) -> dict:
        """Serialize to JSON."""
        return {
            "address": self.address,
            "items": dict(self.items),
            "vxlBalance": self.vxl_balance,
            "totalMined": self.total_mined,
            "totalPlaced": self.total_placed,
            "lastActive": self.last_active,
        }


class EconomySystem:
    """Manages the in-game economy."""

    def __init__(self):
        self.players: Dict[str, PlayerInventory] = {}
        self.market_listings: Dict[str, MarketListing] = {}
        self._next_listing_id = 1
        self.total_vxl_mined = 0.0
        self.block_reward_multiplier = 1.0

    def get_player(self, address: str) -> PlayerInventory:
        """Get or create player inventory."""
        if address not in self.players:
            self.players[address] = PlayerInventory(address)
        player = self.players[address]
        player.last_active = time.time()
        return player

    def process_block_break(self, block_type: int, player_address: str) -> dict:
        """Process a block break event and award rewards."""
        player = self.get_player(player_address)
        player.total_mined += 1

        reward_info = MINING_REWARDS.get(block_type)
        result = {
            "player": player_address,
            "blockType": block_type,
            "vxlReward": 0.0,
            "itemDrop": None,
        }

        if reward_info:
            # VXL reward
            vxl = reward_info.base_reward * self.block_reward_multiplier
            player.vxl_balance += vxl
            self.total_vxl_mined += vxl
            result["vxlReward"] = vxl

            # Item drop
            if reward_info.item_drop != 0 and reward_info.item_count > 0:
                player.add_item(reward_info.item_drop, reward_info.item_count)
                result["itemDrop"] = {
                    "type": reward_info.item_drop,
                    "count": reward_info.item_count,
                }

        return result

    def process_block_place(self, block_type: int, player_address: str) -> dict:
        """Process a block placement event."""
        player = self.get_player(player_address)
        player.total_placed += 1

        # Consume block from inventory (if they have it)
        had_block = player.remove_item(block_type)

        return {
            "player": player_address,
            "blockType": block_type,
            "consumed": had_block,
        }

    def create_listing(self, seller: str, item_type: int,
                       item_count: int, price_vxl: float,
                       listing_type: str = "item",
                       land_x: int = 0, land_z: int = 0,
                       duration_hours: float = 24) -> Optional[dict]:
        """Create a marketplace listing."""
        player = self.get_player(seller)

        if listing_type == "item":
            if not player.has_item(item_type, item_count):
                return None
            # Escrow items
            player.remove_item(item_type, item_count)

        listing_id = f"listing_{self._next_listing_id}"
        self._next_listing_id += 1

        now = time.time()
        listing = MarketListing(
            listing_id=listing_id,
            seller=seller,
            item_type=item_type,
            item_count=item_count,
            price_vxl=price_vxl,
            created_at=now,
            expires_at=now + duration_hours * 3600 if duration_hours > 0 else 0,
            listing_type=listing_type,
            land_x=land_x,
            land_z=land_z,
        )
        self.market_listings[listing_id] = listing

        return {
            "listingId": listing_id,
            "seller": seller,
            "itemType": item_type,
            "itemCount": item_count,
            "price": price_vxl,
            "type": listing_type,
        }

    def buy_listing(self, buyer: str, listing_id: str) -> Optional[dict]:
        """Purchase a marketplace listing."""
        listing = self.market_listings.get(listing_id)
        if not listing:
            return None

        # Check expiration
        if listing.expires_at > 0 and time.time() > listing.expires_at:
            return None

        buyer_inv = self.get_player(buyer)
        seller_inv = self.get_player(listing.seller)

        # Check buyer has enough VXL
        if buyer_inv.vxl_balance < listing.price_vxl:
            return None

        # Transfer
        buyer_inv.vxl_balance -= listing.price_vxl
        seller_inv.vxl_balance += listing.price_vxl

        if listing.listing_type == "item":
            buyer_inv.add_item(listing.item_type, listing.item_count)

        # Remove listing
        del self.market_listings[listing_id]

        return {
            "listingId": listing_id,
            "buyer": buyer,
            "seller": listing.seller,
            "itemType": listing.item_type,
            "itemCount": listing.item_count,
            "price": listing.price_vxl,
        }

    def cancel_listing(self, seller: str, listing_id: str) -> bool:
        """Cancel a marketplace listing and return escrowed items."""
        listing = self.market_listings.get(listing_id)
        if not listing or listing.seller != seller:
            return False

        # Return escrowed items
        if listing.listing_type == "item":
            player = self.get_player(seller)
            player.add_item(listing.item_type, listing.item_count)

        del self.market_listings[listing_id]
        return True

    def get_active_listings(self, listing_type: str = "all") -> List[dict]:
        """Get all active marketplace listings."""
        now = time.time()
        result = []
        for listing in self.market_listings.values():
            if listing.expires_at > 0 and now > listing.expires_at:
                continue
            if listing_type != "all" and listing.listing_type != listing_type:
                continue
            result.append({
                "listingId": listing.listing_id,
                "seller": listing.seller,
                "itemType": listing.item_type,
                "itemCount": listing.item_count,
                "price": listing.price_vxl,
                "type": listing.listing_type,
                "createdAt": listing.created_at,
                "expiresAt": listing.expires_at,
            })
        return result

    def get_leaderboard(self, limit: int = 10) -> List[dict]:
        """Get top players by VXL balance."""
        sorted_players = sorted(
            self.players.values(),
            key=lambda p: p.vxl_balance,
            reverse=True,
        )
        return [
            {
                "address": p.address,
                "vxlBalance": p.vxl_balance,
                "totalMined": p.total_mined,
                "totalPlaced": p.total_placed,
            }
            for p in sorted_players[:limit]
        ]

    def get_economy_stats(self) -> dict:
        """Get overall economy statistics."""
        return {
            "totalPlayers": len(self.players),
            "totalVxlMined": self.total_vxl_mined,
            "activeListings": len(self.market_listings),
            "rewardMultiplier": self.block_reward_multiplier,
        }
