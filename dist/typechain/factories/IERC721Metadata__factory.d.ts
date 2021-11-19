import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IERC721Metadata } from "../IERC721Metadata";
export declare class IERC721Metadata__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): IERC721Metadata;
}
