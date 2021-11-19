import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { ERC721 } from "../ERC721";
export declare class ERC721__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(name_: string, symbol_: string, overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<ERC721>;
    getDeployTransaction(name_: string, symbol_: string, overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): ERC721;
    connect(signer: Signer): ERC721__factory;
    static connect(address: string, signerOrProvider: Signer | Provider): ERC721;
}
