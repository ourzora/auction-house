import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { RestrictedAuctionHouse } from "../RestrictedAuctionHouse";
export declare class RestrictedAuctionHouse__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(_zora: string, _weth: string, overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<RestrictedAuctionHouse>;
    getDeployTransaction(_zora: string, _weth: string, overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): RestrictedAuctionHouse;
    connect(signer: Signer): RestrictedAuctionHouse__factory;
    static connect(address: string, signerOrProvider: Signer | Provider): RestrictedAuctionHouse;
}
