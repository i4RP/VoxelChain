/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    voxelchain_regtest: {
      url: "http://localhost:8545",
      chainId: 784202,
    },
    voxelchain_testnet: {
      url: "http://localhost:8545",
      chainId: 784201,
    },
    voxelchain_mainnet: {
      url: "https://rpc.voxelchain.io",
      chainId: 784200,
    },
  },
};
