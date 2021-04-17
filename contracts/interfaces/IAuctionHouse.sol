// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.8;
pragma experimental ABIEncoderV2;

/**
 * @title Interface for Auction Houses
 */
interface IAuctionHouse {
    struct Auction {
        // Whether or not the auction curator has approved the auction to start
        bool approved;
        // The current highest bid amount
        uint256 amount;
        // The length of time to run the auction for, after the first bid was made
        uint256 duration;
        // The time of the first bid
        uint256 firstBidTime;
        // The minimum price of the first bid
        uint256 reservePrice;
        // The sale percentage to send to the curator
        uint8 curatorFeePercentage;
        // The address that should receive the funds once the NFT is sold.
        address payable creator;
        // The address of the current highest bid
        address payable bidder;
        // The address of the auction's curator.
        // The curator can reject or approve an auction
        address payable curator;
        // The address of the ERC-20 currency to run the auction with.
        // If set to 0x0, the auction will be run in ETH
        address auctionCurrency;
    }

    event AuctionCreated(
        uint256 indexed tokenId,
        uint256 duration,
        uint256 reservePrice,
        address creator,
        address curator,
        uint8 curatorFeePercentage
    );

    event AuctionApprovalUpdated(
        uint256 indexed tokenId,
        bool approved
    );

    event AuctionBid(
        uint256 indexed tokenId,
        address sender,
        uint256 value,
        bool firstBid,
        bool extended
    );

    event AuctionEnded(
        uint256 indexed tokenId,
        address creator,
        address curator,
        address winner,
        uint256 amount,
        uint256 curatorFee,
        address auctionCurrency
    );

    event AuctionCanceled(
        uint256 indexed tokenId,
        address creator
    );

    function createAuction(
        uint256 tokenId,
        uint256 duration,
        uint256 reservePrice,
        address payable creator,
        address payable curator,
        uint8 curatorFeePercentages,
        address auctionCurrency
    ) external;

    function createBid(uint256 tokenId, uint256 amount) external payable;

    function endAuction(uint256 tokenId) external;

    function cancelAuction(uint256 tokenId) external;
}