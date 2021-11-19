import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IAuctionHouse } from "../IAuctionHouse";
export declare class IAuctionHouse__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): IAuctionHouse;
}
