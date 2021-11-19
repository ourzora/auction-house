import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IERC721Enumerable } from "../IERC721Enumerable";
export declare class IERC721Enumerable__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): IERC721Enumerable;
}
