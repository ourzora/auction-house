import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { TestERC721 } from "../TestERC721";
export declare class TestERC721__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<TestERC721>;
    getDeployTransaction(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): TestERC721;
    connect(signer: Signer): TestERC721__factory;
    static connect(address: string, signerOrProvider: Signer | Provider): TestERC721;
}
