import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { ERC165 } from "../ERC165";
export declare class ERC165__factory {
    static connect(address: string, signerOrProvider: Signer | Provider): ERC165;
}
