// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.8;
pragma experimental ABIEncoderV2;

import {IAuctionHouse} from "./IAuctionHouse.sol";

/**
 * @title Interface for Auction Modules.
 * @dev An auction module can be registered in the auction house
 * to add extra functionality to auctions for specific token contracts.
 */
interface IAuctionModule {
    function onAuctionCreate(IAuctionHouse.Auction calldata auction) external;
    function onBid(IAuctionHouse.Auction calldata auction, uint256 tokenId, uint256 amount) external;
    function onCancel(IAuctionHouse.Auction calldata auction) external;
    function onAuctionEnd(IAuctionHouse.Auction calldata auction) external;
}