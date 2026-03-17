/**
 * WalletManager - MetaMask and Web3 wallet integration for VoxelChain
 * Handles wallet connection, chain switching, and transaction signing
 */

const VOXELCHAIN_NETWORKS = {
    mainnet: {
        chainId: '0xBF648',
        chainName: 'VoxelChain Mainnet',
        nativeCurrency: { name: 'VoxelCoin', symbol: 'VXL', decimals: 18 },
        rpcUrls: ['http://localhost:8545/rpc'],
        blockExplorerUrls: ['http://localhost:8545/explorer'],
    },
    testnet: {
        chainId: '0xBF6C9',
        chainName: 'VoxelChain Testnet',
        nativeCurrency: { name: 'VoxelCoin', symbol: 'VXL', decimals: 18 },
        rpcUrls: ['http://localhost:8545/rpc'],
        blockExplorerUrls: ['http://localhost:8545/explorer'],
    },
    regtest: {
        chainId: '0xBF74A',
        chainName: 'VoxelChain Regtest',
        nativeCurrency: { name: 'VoxelCoin', symbol: 'VXL', decimals: 18 },
        rpcUrls: ['http://localhost:18545/rpc'],
        blockExplorerUrls: [],
    },
};

export class WalletManager {
    constructor(network = 'testnet') {
        this.network = network;
        this.networkConfig = VOXELCHAIN_NETWORKS[network];
        this.account = null;
        this.chainId = null;
        this.connected = false;
        this.listeners = new Map();

        if (typeof window !== 'undefined' && window.ethereum) {
            window.ethereum.on('accountsChanged', (accounts) => this._onAccountsChanged(accounts));
            window.ethereum.on('chainChanged', (chainId) => this._onChainChanged(chainId));
            window.ethereum.on('disconnect', () => this._onDisconnect());
        }
    }

    get provider() {
        if (typeof window !== 'undefined' && window.ethereum) {
            return window.ethereum;
        }
        return null;
    }

    get isMetaMaskInstalled() {
        return this.provider !== null && this.provider.isMetaMask === true;
    }

    get isConnected() {
        return this.connected && this.account !== null;
    }

    get shortAddress() {
        if (!this.account) return '';
        return this.account.slice(0, 6) + '...' + this.account.slice(-4);
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        if (!this.listeners.has(event)) return;
        const cbs = this.listeners.get(event);
        const idx = cbs.indexOf(callback);
        if (idx !== -1) cbs.splice(idx, 1);
    }

    _emit(event, data) {
        if (!this.listeners.has(event)) return;
        for (const cb of this.listeners.get(event)) {
            try { cb(data); } catch (e) { console.error('WalletManager event error:', e); }
        }
    }

    async connect() {
        if (!this.provider) {
            throw new Error('No Ethereum provider found. Please install MetaMask.');
        }

        try {
            const accounts = await this.provider.request({ method: 'eth_requestAccounts' });
            if (accounts.length === 0) {
                throw new Error('No accounts available');
            }

            this.account = accounts[0];
            this.chainId = await this.provider.request({ method: 'eth_chainId' });
            this.connected = true;

            if (this.chainId !== this.networkConfig.chainId) {
                await this.switchChain();
            }

            this._emit('connected', { account: this.account, chainId: this.chainId });
            return this.account;
        } catch (error) {
            if (error.code === 4001) {
                throw new Error('User rejected the connection request');
            }
            throw error;
        }
    }

    async disconnect() {
        this.account = null;
        this.chainId = null;
        this.connected = false;
        this._emit('disconnected', {});
    }

    async switchChain() {
        if (!this.provider) return;

        try {
            await this.provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: this.networkConfig.chainId }],
            });
        } catch (error) {
            if (error.code === 4902) {
                await this.addChain();
            } else {
                throw error;
            }
        }
    }

    async addChain() {
        if (!this.provider) return;

        await this.provider.request({
            method: 'wallet_addEthereumChain',
            params: [this.networkConfig],
        });
    }

    async getBalance() {
        if (!this.provider || !this.account) return '0';

        const balance = await this.provider.request({
            method: 'eth_getBalance',
            params: [this.account, 'latest'],
        });

        return this._weiToVxl(balance);
    }

    async sendTransaction(to, value, data = '0x') {
        if (!this.provider || !this.account) {
            throw new Error('Wallet not connected');
        }

        const tx = {
            from: this.account,
            to: to,
            value: typeof value === 'string' ? value : '0x' + BigInt(value).toString(16),
            data: data,
        };

        const txHash = await this.provider.request({
            method: 'eth_sendTransaction',
            params: [tx],
        });

        return txHash;
    }

    async placeBlock(x, y, z, blockType) {
        if (!this.account) throw new Error('Wallet not connected');

        const data = this._encodeVoxelCall('placeBlock', [x, y, z, blockType]);
        return this.sendTransaction(
            '0x0000000000000000000000000000000000000001',
            0,
            data
        );
    }

    async breakBlock(x, y, z) {
        if (!this.account) throw new Error('Wallet not connected');

        const data = this._encodeVoxelCall('breakBlock', [x, y, z]);
        return this.sendTransaction(
            '0x0000000000000000000000000000000000000001',
            0,
            data
        );
    }

    async claimLand(chunkX, chunkZ) {
        if (!this.account) throw new Error('Wallet not connected');

        const data = this._encodeVoxelCall('claimLand', [chunkX, chunkZ]);
        return this.sendTransaction(
            '0x0000000000000000000000000000000000000002',
            0,
            data
        );
    }

    async signMessage(message) {
        if (!this.provider || !this.account) {
            throw new Error('Wallet not connected');
        }

        const signature = await this.provider.request({
            method: 'personal_sign',
            params: [message, this.account],
        });

        return signature;
    }

    _encodeVoxelCall(method, params) {
        const methodSigs = {
            placeBlock: '0x8b3a8e01',
            breakBlock: '0x3f7d5d92',
            claimLand: '0x1a2b3c4d',
            transferItem: '0x5e6f7a8b',
        };

        const sig = methodSigs[method] || '0x00000000';
        let encoded = sig;
        for (const p of params) {
            encoded += BigInt(p).toString(16).padStart(64, '0');
        }
        return encoded;
    }

    _weiToVxl(weiHex) {
        const wei = BigInt(weiHex);
        const vxl = Number(wei) / 1e18;
        return vxl.toFixed(4);
    }

    _onAccountsChanged(accounts) {
        if (accounts.length === 0) {
            this.disconnect();
        } else {
            this.account = accounts[0];
            this._emit('accountChanged', { account: this.account });
        }
    }

    _onChainChanged(chainId) {
        this.chainId = chainId;
        this._emit('chainChanged', { chainId });

        if (chainId !== this.networkConfig.chainId) {
            this._emit('wrongNetwork', {
                current: chainId,
                expected: this.networkConfig.chainId,
            });
        }
    }

    _onDisconnect() {
        this.connected = false;
        this._emit('disconnected', {});
    }
}
