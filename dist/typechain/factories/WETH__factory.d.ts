import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { WETH } from "../WETH";
export declare class WETH__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<WETH>;
    getDeployTransaction(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): WETH;
    connect(signer: Signer): WETH__factory;
    static connect(address: string, signerOrProvider: Signer | Provider): WETH;
}
