import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { BadBidder } from "../BadBidder";
export declare class BadBidder__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(_auction: string, _zora: string, overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<BadBidder>;
    getDeployTransaction(_auction: string, _zora: string, overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): BadBidder;
    connect(signer: Signer): BadBidder__factory;
    static connect(address: string, signerOrProvider: Signer | Provider): BadBidder;
}
