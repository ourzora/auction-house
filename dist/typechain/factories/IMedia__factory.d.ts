import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IMedia } from "../IMedia";
export declare class IMedia__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): IMedia;
}
