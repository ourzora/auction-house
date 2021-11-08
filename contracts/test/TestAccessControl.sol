pragma solidity ^0.6.8;

import "../interfaces/IAccessControl.sol";
import { IERC165 } from "@openzeppelin/contracts/introspection/IERC165.sol";

contract TestAccessControl is IAccessControl, IERC165 {
    bytes32 public constant BIDDER = keccak256("BIDDER");

    mapping(address => bool) public bidders;

    function addBidder(address bidder) external {
        bidders[bidder] = true;
    }

    function hasRole(
        bytes32 role,
        address account
    ) external view override returns (bool) {
        return role == BIDDER && bidders[account];
    }

    function getRoleAdmin(bytes32 role) external view override returns (bytes32) {
        return bytes32(0);
    }
    function grantRole(bytes32 role, address account) external override {}
    function revokeRole(bytes32 role, address account) external override {}
    function renounceRole(bytes32 role, address account) external override {}

    function supportsInterface(
        bytes4 interfaceId
    ) external view override returns (bool) {
        return interfaceId == 0x7965db0b || // IAccessControl
            interfaceId == 0x01ffc9a7; // IERC165
    }
}
