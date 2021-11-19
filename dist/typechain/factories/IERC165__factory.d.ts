import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IERC165 } from "../IERC165";
export declare class IERC165__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): IERC165;
}
