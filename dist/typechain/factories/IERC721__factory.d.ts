import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IERC721 } from "../IERC721";
export declare class IERC721__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): IERC721;
}
