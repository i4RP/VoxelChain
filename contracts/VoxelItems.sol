// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VoxelItems - Game Item Tokens for VoxelChain
 * @notice ERC-1155 multi-token for in-game items, resources, and block types.
 *
 * Token ID ranges:
 * - 1-4095: Block types (stone=1, dirt=2, grass=3, etc.)
 * - 10000-19999: Tools (pickaxe, shovel, axe, etc.)
 * - 20000-29999: Materials (ingots, gems, etc.)
 * - 30000-39999: Special items (keys, potions, etc.)
 *
 * Minting:
 * - Block tokens minted when breaking blocks (mining)
 * - Block tokens burned when placing blocks (building)
 * - Tool/material tokens minted through crafting or rewards
 */

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract VoxelItems is ERC1155, Ownable {
    // Token ID ranges
    uint256 public constant BLOCK_TYPE_MIN = 1;
    uint256 public constant BLOCK_TYPE_MAX = 4095;
    uint256 public constant TOOL_MIN = 10000;
    uint256 public constant TOOL_MAX = 19999;
    uint256 public constant MATERIAL_MIN = 20000;
    uint256 public constant MATERIAL_MAX = 29999;
    uint256 public constant SPECIAL_MIN = 30000;
    uint256 public constant SPECIAL_MAX = 39999;

    // Item metadata
    struct ItemType {
        string name;
        uint256 maxSupply; // 0 = unlimited
        uint256 totalMinted;
        bool transferable;
        bool active;
    }

    // Registered item types
    mapping(uint256 => ItemType) public itemTypes;

    // Authorized minters (e.g., game server, bridge contract)
    mapping(address => bool) public authorizedMinters;

    // Events
    event ItemTypeDefined(uint256 indexed id, string name, uint256 maxSupply);
    event BlockMined(address indexed player, uint256 blockType, uint256 amount);
    event BlockPlaced(address indexed player, uint256 blockType, uint256 amount);
    event MinterAuthorized(address indexed minter, bool authorized);

    modifier onlyMinter() {
        require(
            authorizedMinters[msg.sender] || msg.sender == owner(),
            "Not authorized minter"
        );
        _;
    }

    constructor() ERC1155("https://voxelchain.io/api/items/{id}.json") Ownable(msg.sender) {
        // Register default block types
        _defineBlockType(1, "Stone");
        _defineBlockType(2, "Dirt");
        _defineBlockType(3, "Grass");
        _defineBlockType(4, "Sand");
        _defineBlockType(5, "Water");
        _defineBlockType(6, "Wood");
        _defineBlockType(7, "Leaves");
        _defineBlockType(8, "Brick");
        _defineBlockType(9, "Glass");
        _defineBlockType(10, "Iron Ore");
        _defineBlockType(11, "Gold Ore");
        _defineBlockType(12, "Diamond Ore");
        _defineBlockType(13, "Bedrock");
        _defineBlockType(14, "Cobblestone");
        _defineBlockType(15, "Planks");
        _defineBlockType(16, "Snow");
        _defineBlockType(17, "Ice");
        _defineBlockType(18, "Lava");
        _defineBlockType(19, "Obsidian");
        _defineBlockType(20, "Clay");

        // Register tools
        _defineItem(10001, "Wooden Pickaxe", 0, true);
        _defineItem(10002, "Stone Pickaxe", 0, true);
        _defineItem(10003, "Iron Pickaxe", 0, true);
        _defineItem(10004, "Diamond Pickaxe", 0, true);
        _defineItem(10010, "Wooden Shovel", 0, true);
        _defineItem(10011, "Stone Shovel", 0, true);
        _defineItem(10012, "Iron Shovel", 0, true);

        // Register materials
        _defineItem(20001, "Iron Ingot", 0, true);
        _defineItem(20002, "Gold Ingot", 0, true);
        _defineItem(20003, "Diamond", 0, true);
    }

    /**
     * @notice Mint block tokens when player mines/breaks blocks
     * @param player Player address
     * @param blockType Block type ID (1-4095)
     * @param amount Number of blocks mined
     */
    function mintFromMining(address player, uint256 blockType, uint256 amount)
        external onlyMinter
    {
        require(
            blockType >= BLOCK_TYPE_MIN && blockType <= BLOCK_TYPE_MAX,
            "Invalid block type"
        );
        require(itemTypes[blockType].active, "Block type not registered");

        ItemType storage item = itemTypes[blockType];
        if (item.maxSupply > 0) {
            require(
                item.totalMinted + amount <= item.maxSupply,
                "Exceeds max supply"
            );
        }

        item.totalMinted += amount;
        _mint(player, blockType, amount, "");

        emit BlockMined(player, blockType, amount);
    }

    /**
     * @notice Burn block tokens when player places blocks
     * @param player Player address
     * @param blockType Block type ID (1-4095)
     * @param amount Number of blocks placed
     */
    function burnForPlacement(address player, uint256 blockType, uint256 amount)
        external onlyMinter
    {
        require(
            blockType >= BLOCK_TYPE_MIN && blockType <= BLOCK_TYPE_MAX,
            "Invalid block type"
        );
        require(
            balanceOf(player, blockType) >= amount,
            "Insufficient blocks"
        );

        _burn(player, blockType, amount);

        emit BlockPlaced(player, blockType, amount);
    }

    /**
     * @notice Mint arbitrary items (tools, materials, specials)
     * @param to Recipient address
     * @param id Item ID
     * @param amount Amount to mint
     */
    function mint(address to, uint256 id, uint256 amount)
        external onlyMinter
    {
        require(itemTypes[id].active, "Item type not registered");

        ItemType storage item = itemTypes[id];
        if (item.maxSupply > 0) {
            require(
                item.totalMinted + amount <= item.maxSupply,
                "Exceeds max supply"
            );
        }

        item.totalMinted += amount;
        _mint(to, id, amount, "");
    }

    /**
     * @notice Batch mint items
     * @param to Recipient address
     * @param ids Array of item IDs
     * @param amounts Array of amounts
     */
    function mintBatch(address to, uint256[] calldata ids, uint256[] calldata amounts)
        external onlyMinter
    {
        require(ids.length == amounts.length, "Length mismatch");

        for (uint256 i = 0; i < ids.length; i++) {
            require(itemTypes[ids[i]].active, "Item not registered");
            ItemType storage item = itemTypes[ids[i]];
            if (item.maxSupply > 0) {
                require(
                    item.totalMinted + amounts[i] <= item.maxSupply,
                    "Exceeds max supply"
                );
            }
            item.totalMinted += amounts[i];
        }

        _mintBatch(to, ids, amounts, "");
    }

    /**
     * @notice Define a new item type (owner only)
     * @param id Item ID
     * @param name Item name
     * @param maxSupply Max supply (0 = unlimited)
     * @param transferable Whether the item can be transferred
     */
    function defineItem(
        uint256 id,
        string calldata name,
        uint256 maxSupply,
        bool transferable
    ) external onlyOwner {
        _defineItem(id, name, maxSupply, transferable);
    }

    /**
     * @notice Authorize/revoke a minter address
     * @param minter Address to authorize
     * @param authorized Whether to authorize or revoke
     */
    function setMinter(address minter, bool authorized) external onlyOwner {
        authorizedMinters[minter] = authorized;
        emit MinterAuthorized(minter, authorized);
    }

    /**
     * @notice Set the base URI for token metadata
     * @param newuri New URI string
     */
    function setURI(string calldata newuri) external onlyOwner {
        _setURI(newuri);
    }

    /**
     * @notice Get player's inventory of block types
     * @param player Player address
     * @return blockTypes Array of block type IDs
     * @return balances Array of balances
     */
    function getBlockInventory(address player)
        external view returns (uint256[] memory blockTypes, uint256[] memory balances)
    {
        // Count active block types
        uint256 count = 0;
        for (uint256 i = BLOCK_TYPE_MIN; i <= BLOCK_TYPE_MAX; i++) {
            if (itemTypes[i].active && balanceOf(player, i) > 0) {
                count++;
            }
        }

        blockTypes = new uint256[](count);
        balances = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = BLOCK_TYPE_MIN; i <= BLOCK_TYPE_MAX; i++) {
            if (itemTypes[i].active && balanceOf(player, i) > 0) {
                blockTypes[idx] = i;
                balances[idx] = balanceOf(player, i);
                idx++;
            }
        }
    }

    // === Internal ===

    function _defineBlockType(uint256 id, string memory name) internal {
        _defineItem(id, name, 0, true);
    }

    function _defineItem(
        uint256 id,
        string memory name,
        uint256 maxSupply,
        bool transferable
    ) internal {
        itemTypes[id] = ItemType({
            name: name,
            maxSupply: maxSupply,
            totalMinted: 0,
            transferable: transferable,
            active: true
        });

        emit ItemTypeDefined(id, name, maxSupply);
    }
}
