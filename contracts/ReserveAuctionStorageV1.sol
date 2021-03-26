// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.8;
pragma experimental ABIEncoderV2;

import "./interfaces/IReserveAuction.sol";

contract ReserveAuctionStorageV1 {
    // Emergency boolean to be set in case there is a critical flaw in the auction contract.
    bool public paused;

    // The minimum amount of time left in an auction after a new bid is created
    uint256 public timeBuffer;

    // The minimum percentage difference between the last bid amount and the current bid.
    uint8 public minBidIncrementPercentage;

    // The address of the zora protocol to use via this contract
    address public zora;

    // / The address of the WETH contract, so that any ETH transferred can be handled as an ERC-20
    address public wethAddress;

    // A mapping of all of the auctions currently running.
    mapping(uint256 => IReserveAuction.Auction) public auctions;

    bytes4 constant interfaceId = 0x80ac58cd; // 721 interface id
}