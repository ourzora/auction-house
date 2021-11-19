import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { BadERC721 } from "../BadERC721";
export declare class BadERC721__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<BadERC721>;
    getDeployTransaction(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): BadERC721;
    connect(signer: Signer): BadERC721__factory;
    static connect(address: string, signerOrProvider: Signer | Provider): BadERC721;
}
