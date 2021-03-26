// @ts-ignore
import { ethers } from "hardhat";
import {
  MarketFactory,
  Media,
  MediaFactory,
} from "@zoralabs/core/dist/typechain";
import { BadBidder, ReserveAuction, WETH } from "../typechain";
import { sha256 } from "ethers/lib/utils";
import Decimal from "../utils/Decimal";
import { BigNumber } from "ethers";

export const THOUSANDTH_ETH = ethers.utils.parseUnits(
  "0.001",
  "ether"
) as BigNumber;
export const TENTH_ETH = ethers.utils.parseUnits("0.1", "ether") as BigNumber;
export const ONE_ETH = ethers.utils.parseUnits("1", "ether") as BigNumber;
export const TWO_ETH = ethers.utils.parseUnits("2", "ether") as BigNumber;

export const deployWETH = async () => {
  const [deployer] = await ethers.getSigners();
  return (await (await ethers.getContractFactory("WETH")).deploy()) as WETH;
};

export const deployZoraProtocol = async () => {
  const [deployer] = await ethers.getSigners();
  const market = await (await new MarketFactory(deployer).deploy()).deployed();
  const media = await (
    await new MediaFactory(deployer).deploy(market.address)
  ).deployed();
  await market.configure(media.address);
  return { market, media };
};

export const deployBidder = async (auction: string) => {
  return (await (
    await (await ethers.getContractFactory("BadBidder")).deploy(auction)
  ).deployed()) as BadBidder;
};

export const mint = async (media: Media) => {
  const metadataHex = ethers.utils.formatBytes32String("{}");
  const metadataHash = await sha256(metadataHex);
  const hash = ethers.utils.arrayify(metadataHash);
  await media.mint(
    {
      tokenURI: "zora.co",
      metadataURI: "zora.co",
      contentHash: hash,
      metadataHash: hash,
    },
    {
      prevOwner: Decimal.new(0),
      owner: Decimal.new(85),
      creator: Decimal.new(15),
    }
  );
};

export const approveAuction = async (media: Media, auction: ReserveAuction) => {
  await media.approve(auction.address, 0);
};

export const revert = (messages: TemplateStringsArray) =>
  `VM Exception while processing transaction: revert ${messages[0]}`;
