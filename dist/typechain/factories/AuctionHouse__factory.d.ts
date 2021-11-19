import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { AuctionHouse } from "../AuctionHouse";
export declare class AuctionHouse__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(_zora: string, _weth: string, overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<AuctionHouse>;
    getDeployTransaction(_zora: string, _weth: string, overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): AuctionHouse;
    connect(signer: Signer): AuctionHouse__factory;
    static connect(address: string, signerOrProvider: Signer | Provider): AuctionHouse;
}
