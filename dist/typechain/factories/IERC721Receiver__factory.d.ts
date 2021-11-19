import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IERC721Receiver } from "../IERC721Receiver";
export declare class IERC721Receiver__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): IERC721Receiver;
}
