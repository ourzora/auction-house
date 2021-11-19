import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IMediaExtended } from "../IMediaExtended";
export declare class IMediaExtended__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): IMediaExtended;
}
