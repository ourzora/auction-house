import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IERC20 } from "../IERC20";
export declare class IERC20__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): IERC20;
}
