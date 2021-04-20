// @ts-ignore
import { ethers } from "hardhat";
import chai, { expect } from "chai";
import asPromised from "chai-as-promised";
import {
  deployOtherNFTs,
  deployWETH,
  deployZoraProtocol,
  mint,
  ONE_ETH,
  TENTH_ETH,
  THOUSANDTH_ETH,
  TWO_ETH,
} from "./utils";
import { Market, Media } from "@zoralabs/core/dist/typechain";
import { BigNumber, Signer } from "ethers";
import { AuctionHouse, TestERC721, WETH } from "../typechain";

chai.use(asPromised);

const ONE_DAY = 24 * 60 * 60;

// helper function so we can parse numbers and do approximate number calculations, to avoid annoying gas calculations
const smallify = (bn: BigNumber) => bn.div(THOUSANDTH_ETH).toNumber();

describe("integration", () => {
  let market: Market;
  let media: Media;
  let weth: WETH;
  let auction: AuctionHouse;
  let otherNft: TestERC721;
  let deployer, creator, owner, curator, bidderA, bidderB, otherUser: Signer;
  let deployerAddress,
    ownerAddress,
    creatorAddress,
    curatorAddress,
    bidderAAddress,
    bidderBAddress,
    otherUserAddress: string;

  async function deploy(): Promise<AuctionHouse> {
    const AuctionHouse = await ethers.getContractFactory("AuctionHouse");
    const auctionHouse = await AuctionHouse.deploy(media.address, weth.address);

    return auctionHouse as AuctionHouse;
  }

  beforeEach(async () => {
    await ethers.provider.send("hardhat_reset", []);
    [
      deployer,
      creator,
      owner,
      curator,
      bidderA,
      bidderB,
      otherUser,
    ] = await ethers.getSigners();
    [
      deployerAddress,
      creatorAddress,
      ownerAddress,
      curatorAddress,
      bidderAAddress,
      bidderBAddress,
      otherUserAddress,
    ] = await Promise.all(
      [deployer, creator, owner, curator, bidderA, bidderB].map((s) =>
        s.getAddress()
      )
    );
    const contracts = await deployZoraProtocol();
    const nfts = await deployOtherNFTs();
    market = contracts.market;
    media = contracts.media;
    weth = await deployWETH();
    auction = await deploy();
    otherNft = nfts.test;
    await mint(media.connect(creator));
    await otherNft.mint(creator.address, 0);
    await media.connect(creator).transferFrom(creatorAddress, ownerAddress, 0);
    await otherNft
      .connect(creator)
      .transferFrom(creatorAddress, ownerAddress, 0);
  });

  describe("ETH Auction with no curator", async () => {
    async function run() {
      await media.connect(owner).approve(auction.address, 0);
      await auction
        .connect(owner)
        .createAuction(
          0,
          media.address,
          ONE_DAY,
          TENTH_ETH,
          ethers.constants.AddressZero,
          0,
          ethers.constants.AddressZero
        );
      await auction
        .connect(bidderA)
        .createBid(media.address, 0, ONE_ETH, { value: ONE_ETH });
      await auction
        .connect(bidderB)
        .createBid(media.address, 0, TWO_ETH, { value: TWO_ETH });
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Date.now() + ONE_DAY,
      ]);
      await auction.connect(otherUser).endAuction(media.address, 0);
    }

    it("should transfer the NFT to the winning bidder", async () => {
      await run();
      expect(await media.ownerOf(0)).to.eq(bidderBAddress);
    });

    it("should withdraw the winning bid amount from the winning bidder", async () => {
      const beforeBalance = await ethers.provider.getBalance(bidderBAddress);
      await run();
      const afterBalance = await ethers.provider.getBalance(bidderBAddress);

      expect(smallify(beforeBalance.sub(afterBalance))).to.be.approximately(
        smallify(TWO_ETH),
        smallify(TENTH_ETH)
      );
    });

    it("should refund the losing bidder", async () => {
      const beforeBalance = await ethers.provider.getBalance(bidderAAddress);
      await run();
      const afterBalance = await ethers.provider.getBalance(bidderAAddress);

      expect(smallify(beforeBalance)).to.be.approximately(
        smallify(afterBalance),
        smallify(TENTH_ETH)
      );
    });

    it("should pay the auction creator", async () => {
      const beforeBalance = await ethers.provider.getBalance(ownerAddress);
      await run();
      const afterBalance = await ethers.provider.getBalance(ownerAddress);

      // 15% creator fee -> 2ETH * 85% = 1.7 ETH
      expect(smallify(afterBalance)).to.be.approximately(
        smallify(beforeBalance.add(TENTH_ETH.mul(17))),
        smallify(TENTH_ETH)
      );
    });

    it("should pay the token creator in WETH", async () => {
      const beforeBalance = await weth.balanceOf(creatorAddress);
      await run();
      const afterBalance = await weth.balanceOf(creatorAddress);

      // 15% creator fee -> 2 ETH * 15% = 0.3 WETH
      expect(afterBalance).to.eq(beforeBalance.add(THOUSANDTH_ETH.mul(300)));
    });
  });

  describe("ETH auction with curator", () => {
    async function run() {
      await media.connect(owner).approve(auction.address, 0);
      await auction
        .connect(owner)
        .createAuction(
          0,
          media.address,
          ONE_DAY,
          TENTH_ETH,
          curatorAddress,
          20,
          ethers.constants.AddressZero
        );
      await auction.connect(curator).setAuctionApproval(media.address, 0, true);
      await auction
        .connect(bidderA)
        .createBid(media.address, 0, ONE_ETH, { value: ONE_ETH });
      await auction
        .connect(bidderB)
        .createBid(media.address, 0, TWO_ETH, { value: TWO_ETH });
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Date.now() + ONE_DAY,
      ]);
      await auction.connect(otherUser).endAuction(media.address, 0);
    }

    it("should transfer the NFT to the winning bidder", async () => {
      await run();
      expect(await media.ownerOf(0)).to.eq(bidderBAddress);
    });

    it("should withdraw the winning bid amount from the winning bidder", async () => {
      const beforeBalance = await ethers.provider.getBalance(bidderBAddress);
      await run();
      const afterBalance = await ethers.provider.getBalance(bidderBAddress);

      expect(smallify(beforeBalance.sub(afterBalance))).to.be.approximately(
        smallify(TWO_ETH),
        smallify(TENTH_ETH)
      );
    });

    it("should refund the losing bidder", async () => {
      const beforeBalance = await ethers.provider.getBalance(bidderAAddress);
      await run();
      const afterBalance = await ethers.provider.getBalance(bidderAAddress);

      expect(smallify(beforeBalance)).to.be.approximately(
        smallify(afterBalance),
        smallify(TENTH_ETH)
      );
    });

    it("should pay the auction creator", async () => {
      const beforeBalance = await ethers.provider.getBalance(ownerAddress);
      await run();
      const afterBalance = await ethers.provider.getBalance(ownerAddress);

      expect(smallify(afterBalance)).to.be.approximately(
        // 15% creator share + 20% curator fee  -> 1.7 ETH * 80% = 1.36 ETH
        smallify(beforeBalance.add(TENTH_ETH.mul(14))),
        smallify(TENTH_ETH)
      );
    });

    it("should pay the token creator in WETH", async () => {
      const beforeBalance = await weth.balanceOf(creatorAddress);
      await run();
      const afterBalance = await weth.balanceOf(creatorAddress);

      // 15% creator fee  -> 2 ETH * 15% = 0.3 WETH
      expect(afterBalance).to.eq(beforeBalance.add(THOUSANDTH_ETH.mul(300)));
    });

    it("should pay the curator", async () => {
      const beforeBalance = await ethers.provider.getBalance(curatorAddress);
      await run();
      const afterBalance = await ethers.provider.getBalance(curatorAddress);

      // 20% of 1.7 WETH -> 0.34
      expect(smallify(afterBalance)).to.be.approximately(
        smallify(beforeBalance.add(THOUSANDTH_ETH.mul(340))),
        smallify(TENTH_ETH)
      );
    });
  });

  describe("WETH Auction with no curator", () => {
    async function run() {
      await media.connect(owner).approve(auction.address, 0);
      await auction
        .connect(owner)
        .createAuction(
          0,
          media.address,
          ONE_DAY,
          TENTH_ETH,
          ethers.constants.AddressZero,
          20,
          weth.address
        );
      await weth.connect(bidderA).deposit({ value: ONE_ETH });
      await weth.connect(bidderA).approve(auction.address, ONE_ETH);
      await weth.connect(bidderB).deposit({ value: TWO_ETH });
      await weth.connect(bidderB).approve(auction.address, TWO_ETH);
      await auction
        .connect(bidderA)
        .createBid(media.address, 0, ONE_ETH, { value: ONE_ETH });
      await auction
        .connect(bidderB)
        .createBid(media.address, 0, TWO_ETH, { value: TWO_ETH });
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Date.now() + ONE_DAY,
      ]);
      await auction.connect(otherUser).endAuction(media.address, 0);
    }

    it("should transfer the NFT to the winning bidder", async () => {
      await run();
      expect(await media.ownerOf(0)).to.eq(bidderBAddress);
    });

    it("should withdraw the winning bid amount from the winning bidder", async () => {
      await run();
      const afterBalance = await weth.balanceOf(bidderBAddress);

      expect(afterBalance).to.eq(ONE_ETH.mul(0));
    });

    it("should refund the losing bidder", async () => {
      await run();
      const afterBalance = await weth.balanceOf(bidderAAddress);

      expect(afterBalance).to.eq(ONE_ETH);
    });

    it("should pay the auction creator", async () => {
      await run();
      const afterBalance = await weth.balanceOf(ownerAddress);

      // 15% creator fee -> 2 ETH * 85% = 1.7WETH
      expect(afterBalance).to.eq(TENTH_ETH.mul(17));
    });

    it("should pay the token creator", async () => {
      const beforeBalance = await weth.balanceOf(creatorAddress);
      await run();
      const afterBalance = await weth.balanceOf(creatorAddress);

      // 15% creator fee -> 2 ETH * 15% = 0.3 WETH
      expect(afterBalance).to.eq(beforeBalance.add(THOUSANDTH_ETH.mul(300)));
    });
  });

  describe("WETH auction with curator", async () => {
    async function run() {
      await media.connect(owner).approve(auction.address, 0);
      await auction
        .connect(owner)
        .createAuction(
          0,
          media.address,
          ONE_DAY,
          TENTH_ETH,
          curator.address,
          20,
          weth.address
        );
      await auction.connect(curator).setAuctionApproval(media.address, 0, true);
      await weth.connect(bidderA).deposit({ value: ONE_ETH });
      await weth.connect(bidderA).approve(auction.address, ONE_ETH);
      await weth.connect(bidderB).deposit({ value: TWO_ETH });
      await weth.connect(bidderB).approve(auction.address, TWO_ETH);
      await auction
        .connect(bidderA)
        .createBid(media.address, 0, ONE_ETH, { value: ONE_ETH });
      await auction
        .connect(bidderB)
        .createBid(media.address, 0, TWO_ETH, { value: TWO_ETH });
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Date.now() + ONE_DAY,
      ]);
      await auction.connect(otherUser).endAuction(media.address, 0);
    }

    it("should transfer the NFT to the winning bidder", async () => {
      await run();
      expect(await media.ownerOf(0)).to.eq(bidderBAddress);
    });

    it("should withdraw the winning bid amount from the winning bidder", async () => {
      await run();
      const afterBalance = await weth.balanceOf(bidderBAddress);

      expect(afterBalance).to.eq(ONE_ETH.mul(0));
    });

    it("should refund the losing bidder", async () => {
      await run();
      const afterBalance = await weth.balanceOf(bidderAAddress);

      expect(afterBalance).to.eq(ONE_ETH);
    });

    it("should pay the auction creator", async () => {
      await run();
      const afterBalance = await weth.balanceOf(ownerAddress);

      // 15% creator fee + 20% curator fee -> 2 ETH * 85% * 80% = 1.36WETH
      expect(afterBalance).to.eq(THOUSANDTH_ETH.mul(1360));
    });

    it("should pay the token creator", async () => {
      const beforeBalance = await weth.balanceOf(creatorAddress);
      await run();
      const afterBalance = await weth.balanceOf(creatorAddress);

      // 15% creator fee -> 2 ETH * 15% = 0.3 WETH
      expect(afterBalance).to.eq(beforeBalance.add(THOUSANDTH_ETH.mul(300)));
    });

    it("should pay the auction curator", async () => {
      const beforeBalance = await weth.balanceOf(curatorAddress);
      await run();
      const afterBalance = await weth.balanceOf(curatorAddress);

      // 15% creator fee + 20% curator fee = 2 ETH * 85% * 20% = 0.34 WETH
      expect(afterBalance).to.eq(beforeBalance.add(THOUSANDTH_ETH.mul(340)));
    });
  });

  describe("3rd party nft auction", async () => {
    async function run() {
      await otherNft.connect(owner).approve(auction.address, 0);
      await auction
        .connect(owner)
        .createAuction(
          0,
          otherNft.address,
          ONE_DAY,
          TENTH_ETH,
          curatorAddress,
          20,
          ethers.constants.AddressZero
        );
      await auction
        .connect(curator)
        .setAuctionApproval(otherNft.address, 0, true);
      await auction
        .connect(bidderA)
        .createBid(otherNft.address, 0, ONE_ETH, { value: ONE_ETH });
      await auction
        .connect(bidderB)
        .createBid(otherNft.address, 0, TWO_ETH, { value: TWO_ETH });
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Date.now() + ONE_DAY,
      ]);
      await auction.connect(otherUser).endAuction(otherNft.address, 0);
    }
    it("should transfer the NFT to the winning bidder", async () => {
      await run();
      expect(await otherNft.ownerOf(0)).to.eq(bidderBAddress);
    });

    it("should withdraw the winning bid amount from the winning bidder", async () => {
      const beforeBalance = await ethers.provider.getBalance(bidderBAddress);
      await run();
      const afterBalance = await ethers.provider.getBalance(bidderBAddress);

      expect(smallify(beforeBalance.sub(afterBalance))).to.be.approximately(
        smallify(TWO_ETH),
        smallify(TENTH_ETH)
      );
    });

    it("should refund the losing bidder", async () => {
      const beforeBalance = await ethers.provider.getBalance(bidderAAddress);
      await run();
      const afterBalance = await ethers.provider.getBalance(bidderAAddress);

      expect(smallify(beforeBalance)).to.be.approximately(
        smallify(afterBalance),
        smallify(TENTH_ETH)
      );
    });

    it("should pay the auction creator", async () => {
      const beforeBalance = await ethers.provider.getBalance(ownerAddress);
      await run();
      const afterBalance = await ethers.provider.getBalance(ownerAddress);

      expect(smallify(afterBalance)).to.be.approximately(
        // 20% curator fee  -> 2 ETH * 80% = 1.6 ETH
        smallify(beforeBalance.add(TENTH_ETH.mul(16))),
        smallify(TENTH_ETH)
      );
    });

    it("should pay the curator", async () => {
      const beforeBalance = await ethers.provider.getBalance(curatorAddress);
      await run();
      const afterBalance = await ethers.provider.getBalance(curatorAddress);

      // 20% of 2 WETH -> 0.4
      expect(smallify(afterBalance)).to.be.approximately(
        smallify(beforeBalance.add(TENTH_ETH.mul(4))),
        smallify(THOUSANDTH_ETH)
      );
    });
  });
});
