<?php

use Doctrine\ORM\Tools\Console\ConsoleRunner;
use Doctrine\ORM\Tools\Console\EntityManagerProvider\SingleManagerProvider;

// Adjust this path to your actual bootstrap.php
require_once "bootstrap.php";

ConsoleRunner::run(
    new SingleManagerProvider($entityManager)
);