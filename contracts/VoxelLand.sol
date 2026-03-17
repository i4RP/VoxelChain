// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VoxelLand - Land Ownership NFT for VoxelChain
 * @notice ERC-721 NFT representing land plot ownership in the VoxelChain world.
 *
 * Land System:
 * - World divided into chunks (16x16x16 voxels each)
 * - Land plots = groups of 4x4 chunks (64x64 voxels horizontally)
 * - Each land plot is an NFT with unique (plotX, plotZ) coordinates
 * - Only the land owner can place/break blocks within their plot
 * - Unclaimed land is free to build on (first-come, first-served claiming)
 *
 * Token ID encoding: plotX * 2^32 + plotZ (supports negative coords via offset)
 */

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract VoxelLand is ERC721, ERC721Enumerable, Ownable {
    // Constants
    uint256 public constant CHUNK_SIZE = 16;
    uint256 public constant LAND_PLOT_SIZE = 4; // 4x4 chunks per plot
    uint256 public constant COORD_OFFSET = 1_000_000; // Support negative coords
    uint256 public constant COORD_MULTIPLIER = 2_000_001;

    // Claim fee in native currency (VXL)
    uint256 public claimFee = 10 ether; // 10 VXL

    // Plot data
    struct PlotInfo {
        int32 plotX;
        int32 plotZ;
        uint256 claimedAt;
        bytes32 merkleRoot; // Latest merkle root of chunk data
        string metadataURI;
    }

    // Mapping from token ID to plot info
    mapping(uint256 => PlotInfo) public plots;

    // Mapping from (plotX, plotZ) hash to token ID for lookup
    mapping(bytes32 => uint256) public coordToTokenId;

    // Mapping from (plotX, plotZ) hash to claimed status
    mapping(bytes32 => bool) public isClaimed;

    // Events
    event LandClaimed(
        address indexed owner,
        int32 plotX,
        int32 plotZ,
        uint256 tokenId
    );
    event LandMerkleRootUpdated(
        uint256 indexed tokenId,
        bytes32 oldRoot,
        bytes32 newRoot
    );
    event ClaimFeeUpdated(uint256 oldFee, uint256 newFee);

    constructor() ERC721("VoxelChain Land", "VXLAND") Ownable(msg.sender) {}

    /**
     * @notice Claim an unclaimed land plot
     * @param plotX X coordinate of the land plot
     * @param plotZ Z coordinate of the land plot
     */
    function claimLand(int32 plotX, int32 plotZ) external payable {
        require(msg.value >= claimFee, "Insufficient claim fee");

        bytes32 coordHash = _coordHash(plotX, plotZ);
        require(!isClaimed[coordHash], "Land already claimed");

        uint256 tokenId = _encodeTokenId(plotX, plotZ);

        isClaimed[coordHash] = true;
        coordToTokenId[coordHash] = tokenId;
        plots[tokenId] = PlotInfo({
            plotX: plotX,
            plotZ: plotZ,
            claimedAt: block.timestamp,
            merkleRoot: bytes32(0),
            metadataURI: ""
        });

        _safeMint(msg.sender, tokenId);

        emit LandClaimed(msg.sender, plotX, plotZ, tokenId);

        // Refund excess payment
        if (msg.value > claimFee) {
            payable(msg.sender).transfer(msg.value - claimFee);
        }
    }

    /**
     * @notice Update the merkle root of a land plot (only owner)
     * @param tokenId Token ID of the land plot
     * @param newMerkleRoot New merkle root hash of chunk data
     */
    function updateMerkleRoot(uint256 tokenId, bytes32 newMerkleRoot) external {
        require(ownerOf(tokenId) == msg.sender, "Not land owner");

        bytes32 oldRoot = plots[tokenId].merkleRoot;
        plots[tokenId].merkleRoot = newMerkleRoot;

        emit LandMerkleRootUpdated(tokenId, oldRoot, newMerkleRoot);
    }

    /**
     * @notice Check if an address is the owner of a specific plot coordinate
     * @param addr Address to check
     * @param plotX X coordinate
     * @param plotZ Z coordinate
     * @return True if the address owns the plot
     */
    function isPlotOwner(address addr, int32 plotX, int32 plotZ)
        external view returns (bool)
    {
        bytes32 coordHash = _coordHash(plotX, plotZ);
        if (!isClaimed[coordHash]) return false;
        uint256 tokenId = coordToTokenId[coordHash];
        return ownerOf(tokenId) == addr;
    }

    /**
     * @notice Check if a world position is within a claimed plot
     * @param worldX World X coordinate
     * @param worldZ World Z coordinate
     * @return owner Address of the plot owner (address(0) if unclaimed)
     */
    function getPlotOwnerAtWorldPos(int256 worldX, int256 worldZ)
        external view returns (address owner)
    {
        int32 plotX = int32(worldX / int256(uint256(CHUNK_SIZE * LAND_PLOT_SIZE)));
        int32 plotZ = int32(worldZ / int256(uint256(CHUNK_SIZE * LAND_PLOT_SIZE)));

        bytes32 coordHash = _coordHash(plotX, plotZ);
        if (!isClaimed[coordHash]) return address(0);

        uint256 tokenId = coordToTokenId[coordHash];
        return ownerOf(tokenId);
    }

    /**
     * @notice Set claim fee (only contract owner)
     * @param newFee New claim fee in wei
     */
    function setClaimFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = claimFee;
        claimFee = newFee;
        emit ClaimFeeUpdated(oldFee, newFee);
    }

    /**
     * @notice Set metadata URI for a plot (only plot owner)
     * @param tokenId Token ID
     * @param uri Metadata URI (IPFS hash etc.)
     */
    function setPlotMetadataURI(uint256 tokenId, string calldata uri) external {
        require(ownerOf(tokenId) == msg.sender, "Not land owner");
        plots[tokenId].metadataURI = uri;
    }

    /**
     * @notice Withdraw collected claim fees (only contract owner)
     */
    function withdrawFees() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    /**
     * @notice Get plot info by coordinates
     * @param plotX X coordinate
     * @param plotZ Z coordinate
     * @return info PlotInfo struct
     */
    function getPlotByCoord(int32 plotX, int32 plotZ)
        external view returns (PlotInfo memory info)
    {
        bytes32 coordHash = _coordHash(plotX, plotZ);
        require(isClaimed[coordHash], "Plot not claimed");
        uint256 tokenId = coordToTokenId[coordHash];
        return plots[tokenId];
    }

    // === Internal ===

    function _coordHash(int32 plotX, int32 plotZ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(plotX, plotZ));
    }

    function _encodeTokenId(int32 plotX, int32 plotZ)
        internal pure returns (uint256)
    {
        uint256 x = uint256(int256(plotX) + int256(uint256(COORD_OFFSET)));
        uint256 z = uint256(int256(plotZ) + int256(uint256(COORD_OFFSET)));
        return x * COORD_MULTIPLIER + z;
    }

    // Required overrides for ERC721Enumerable
    function _update(address to, uint256 tokenId, address auth)
        internal override(ERC721, ERC721Enumerable) returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721Enumerable) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
