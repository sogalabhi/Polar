// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title PolkaBridge Pool
 * @notice Holds liquidity and releases it when the relayer detects Stellar lock events
 */
contract PolkaBridgePool {
    address public admin;
    uint256 public totalReleased;

    event LiquidityReleased(address indexed to, uint256 amount);
    event FundsReceived(address indexed from, uint256 amount);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /**
     * @notice Receive funds into the pool (anyone can fund it)
     */
    receive() external payable {
        emit FundsReceived(msg.sender, msg.value);
    }

    /**
     * @notice Fund the pool explicitly
     */
    function fund() external payable {
        emit FundsReceived(msg.sender, msg.value);
    }

    /**
     * @notice Release liquidity to a user (admin/relayer only)
     * @param to The recipient address
     * @param amount The amount to send (in wei)
     */
    function releaseLiquidity(address payable to, uint256 amount) external onlyAdmin {
        require(address(this).balance >= amount, "Insufficient pool balance");
        
        totalReleased += amount;
        
        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");
        
        emit LiquidityReleased(to, amount);
    }

    /**
     * @notice Get the pool's current balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Change the admin address
     */
    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin address");
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }
}
