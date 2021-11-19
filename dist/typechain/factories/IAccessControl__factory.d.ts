import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IAccessControl } from "../IAccessControl";
export declare class IAccessControl__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): IAccessControl;
}
