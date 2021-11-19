import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { TestAccessControl } from "../TestAccessControl";
export declare class TestAccessControl__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<TestAccessControl>;
    getDeployTransaction(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): TestAccessControl;
    connect(signer: Signer): TestAccessControl__factory;
    static connect(address: string, signerOrProvider: Signer | Provider): TestAccessControl;
}
