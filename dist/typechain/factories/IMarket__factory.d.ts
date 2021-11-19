import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IMarket } from "../IMarket";
export declare class IMarket__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): IMarket;
}
